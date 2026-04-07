package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.dtos.WorldDto;
import com.tutien.pixel.entities.worldEntity;
import com.tutien.pixel.services.WorldService;
import jakarta.websocket.server.PathParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/worlds")
@CrossOrigin("*") // Để Angular gọi được API mà không bị lỗi CORS
public class WorldController {

    @Autowired
    private WorldService worldService;

    @GetMapping
    public List<worldEntity> getAll() {
        return worldService.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<worldEntity> getById(@PathVariable int id) {
        return worldService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/by-code")
    public ResponseEntity<Optional<WorldDto>> getByCode(@RequestParam String code) throws Exception {
        return ResponseEntity.ok(worldService.getWorld(code));
    }

    @PostMapping
    public worldEntity create(@RequestBody worldEntity world) {
        return worldService.save(world);
    }

    @PutMapping("/{id}")
    public ResponseEntity<worldEntity> update(@PathVariable int id, @RequestBody worldEntity world) {
        return ResponseEntity.ok(worldService.update(id, world));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable int id) {
        worldService.delete(id);
        return ResponseEntity.noContent().build();
    }
}