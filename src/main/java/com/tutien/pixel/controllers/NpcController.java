package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.npcEntity;
import com.tutien.pixel.services.NpcService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/npc")
public class NpcController {
    @Autowired
    NpcService service;

    @GetMapping
    public List<npcEntity> all() {
        return service.all();
    }

    @GetMapping("/{id}")
    public npcEntity get(@PathVariable int id) {
        return service.get(id);
    }

    @GetMapping("/code/{code}")
    public npcEntity getByCode(@PathVariable String code) {
        return service.getByCode(code);
    }

    @GetMapping("/map/{mapCode}")
    public List<npcEntity> getByMap(@PathVariable String mapCode) {
        return service.getByMap(mapCode);
    }

    @PostMapping
    public npcEntity save(@RequestBody npcEntity n) {
        return service.save(n);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}
