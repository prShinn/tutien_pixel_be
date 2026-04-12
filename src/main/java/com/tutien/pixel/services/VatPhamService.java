package com.tutien.pixel.services;

import com.tutien.pixel.entities.vatPhamEntity;
import com.tutien.pixel.repositories.VatPhamRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class VatPhamService {

    @Autowired
    private VatPhamRepository repo;

    public List<vatPhamEntity> getAll() {
        return repo.findAll();
    }

    public vatPhamEntity getById(int id) {
        return repo.findById(id).orElseThrow();
    }

    public vatPhamEntity getByCode(String code) {
        return repo.findByCode(code).orElseThrow();
    }

    public vatPhamEntity create(vatPhamEntity v) {
        return repo.save(v);
    }

    public vatPhamEntity update(int id, vatPhamEntity v) {
        vatPhamEntity old = repo.findById(id).orElseThrow();

        old.setName(v.getName());
        old.setCode(v.getCode());
        old.setDescription(v.getDescription());
        old.setIcon(v.getIcon());
        old.setType(v.getType());
        old.setGiaBan(v.getGiaBan());
        old.setGiaMua(v.getGiaMua());
        old.setGiaTriTuVi(v.getGiaTriTuVi());
        old.setGiaTriTang(v.getGiaTriTang());
        old.setCapTrangBi(v.getCapTrangBi());

        return repo.save(old);
    }

    public void deleteById(int id) {
        repo.deleteById(id);
    }

    public void deleteByCode(String code) {
        repo.deleteByCode(code);
    }
}