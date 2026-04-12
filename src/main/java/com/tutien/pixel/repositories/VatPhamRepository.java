package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.vatPhamEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface VatPhamRepository extends JpaRepository<vatPhamEntity, Integer> {
    Optional<vatPhamEntity> findByCode(String code);

    void deleteByCode(String code);
}